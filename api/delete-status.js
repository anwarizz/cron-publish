import { createClient } from "@supabase/supabase-js";

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method Not Allowed" });

  try {
    const { id, action, password } = req.body;

    if (!id || !action) {
      return res.status(400).json({ error: "ID and Action are required." });
    }

    // Password verification specifically for cancelling PENDING status
    if (action === "CANCEL") {
      if (password !== "iloveyou") {
        return res
          .status(403)
          .json({ error: "Confirmation failed: Invalid passphrase." });
      }

      // Delete the item from the database and remove the file from storage if present
      const { data: item } = await supabase
        .from("scheduled_uploads")
        .select("storage_path")
        .eq("id", id)
        .single();
      if (item?.storage_path) {
        await supabase.storage.from("addon-files").remove([item.storage_path]);
      }

      const { error } = await supabase
        .from("scheduled_uploads")
        .delete()
        .eq("id", id);
      if (error) throw error;

      return res
        .status(200)
        .json({
          success: true,
          message: "Push schedule successfully cancelled.",
        });
    }

    // Remove record from history (COMPLETED / FAILED)
    if (action === "DELETE_HISTORY") {
      const { error } = await supabase
        .from("scheduled_uploads")
        .delete()
        .eq("id", id);
      if (error) throw error;

      return res
        .status(200)
        .json({
          success: true,
          message: "History entry successfully deleted.",
        });
    }

    res.status(400).json({ error: "Invalid action." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
