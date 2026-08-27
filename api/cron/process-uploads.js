import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // 1. Verifikasi Header Authorization dari cron-job.org
  const authHeader = req.headers.authorization;
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid Cron Secret Key" });
  }

  try {
    const nowISO = new Date().toISOString();

    // 2. Query Supabase: Ambil antrean PENDING yang scheduled_at <= Jam Sekarang
    const { data: rows, error: selectError } = await supabase
      .from("scheduled_uploads")
      .select("*")
      .eq("status", "PENDING")
      .lte("scheduled_at", nowISO)
      .limit(5);

    if (selectError) throw selectError;
    if (!rows || rows.length === 0) {
      return res
        .status(200)
        .json({
          message: "Tidak ada antrean file yang perlu di-push saat ini.",
        });
    }

    for (const item of rows) {
      // Tandai status sedang diproses
      await supabase
        .from("scheduled_uploads")
        .update({ status: "PROCESSING" })
        .eq("id", item.id);

      try {
        // 3. Download file dari Supabase Storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("addon-files")
          .download(item.storage_path);

        if (downloadError) throw downloadError;

        // 4. Menyusun Multipart FormData menggunakan Native Web API bawaan Node.js
        const metadataJson = JSON.stringify({
          changelog: item.changelog || "",
          changelogType: "text",
          releaseType: item.release_type,
          gameVersionNames: [item.game_version],
        });

        const formData = new FormData();
        // Masukkan metadata langsung sebagai string JSON biasa
        formData.append("metadata", metadataJson);

        // Bungkus fileData ke dalam Blob baru agar dikenali sebagai file oleh Vercel Native FormData
        const fileBlob = new Blob([await fileData.arrayBuffer()], {
          type: "application/octet-stream",
        });
        formData.append("file", fileBlob, item.file_name);

        // 5. Push ke CurseForge API menggunakan Native fetch
        const cfResponse = await fetch(
          `https://minecraft.curseforge.com/api/projects/${item.project_id}/upload-file`,
          {
            method: "POST",
            headers: {
              "X-Api-Token": item.token,
            },
            body: formData,
          },
        );

        const responseText = await cfResponse.text();

        if (cfResponse.ok) {
          // Update status ke COMPLETED jika berhasil
          await supabase
            .from("scheduled_uploads")
            .update({
              status: "COMPLETED",
              cf_response: responseText,
              uploaded_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          // HAPUS FILE DARI SUPABASE STORAGE SECARA OTOMATIS
          await supabase.storage
            .from("addon-files")
            .remove([item.storage_path]);
        } else {
          // Update status ke FAILED jika API CurseForge menolak
          await supabase
            .from("scheduled_uploads")
            .update({ status: "FAILED", error: responseText })
            .eq("id", item.id);
        }
      } catch (err) {
        await supabase
          .from("scheduled_uploads")
          .update({ status: "FAILED", error: err.message })
          .eq("id", item.id);
      }
    }

    res.status(200).json({ success: true, processed: rows.length });
  } catch (error) {
    console.error("Cron Execution Error:", error);
    res.status(500).json({ error: error.message });
  }
}
