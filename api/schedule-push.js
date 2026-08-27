import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use Service Role Key for full backend access
const supabase = createClient(supabaseUrl, supabaseKey);

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method Not Allowed" });

  const form = formidable({});

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Failed to process file" });

    try {
      const token = fields.token[0];
      const projectId = fields.projectId[0];
      const projectName = fields.projectName?.[0] || "";
      const gameVersion = fields.gameVersion[0];
      const releaseType = fields.releaseType[0];
      const changelog = fields.changelog?.[0] || "";
      const scheduledTimestamp = fields.scheduledTimestamp?.[0];

      const file = files.file[0];
      const fileBuffer = fs.readFileSync(file.filepath);
      const filePathInStorage = `${Date.now()}_${file.originalFilename}`;

      // 1. Upload file to Supabase Storage (Bucket: addon-files)
      const { data: storageData, error: storageError } = await supabase.storage
        .from("addon-files")
        .upload(filePathInStorage, fileBuffer, {
          contentType: file.mimetype || "application/octet-stream",
          upsert: false,
        });

      if (storageError)
        throw new Error(`Storage Upload Error: ${storageError.message}`);

      // 2. Determine execution time (UTC)
      let targetTime;
      if (scheduledTimestamp) {
        targetTime = new Date(scheduledTimestamp).toISOString();
      } else {
        // If no schedule is provided, subtract 10 minutes from current time
        // to ensure it is marked as past due for the UTC server Cron Job
        targetTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      }

      // 3. Insert metadata to Supabase Database
      const { data: dbData, error: dbError } = await supabase
        .from("scheduled_uploads")
        .insert([
          {
            token,
            project_id: projectId,
            project_name: projectName,
            game_version: gameVersion,
            release_type: releaseType,
            changelog,
            file_name: file.originalFilename,
            storage_path: filePathInStorage,
            scheduled_at: targetTime,
            status: "PENDING",
          },
        ])
        .select();

      if (dbError) throw new Error(`Database Insert Error: ${dbError.message}`);

      res.status(200).json({
        success: true,
        message: "Schedule push successfully saved.",
        id: dbData[0].id,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
