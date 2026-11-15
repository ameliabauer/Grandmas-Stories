module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: "The transcription service is not configured." });

  const mime = String(req.headers["content-type"] || "audio/webm").split(";")[0].trim();
  if (!mime.startsWith("audio/")) return res.status(415).json({ error: "Please send an audio recording." });

  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > 20 * 1024 * 1024) return res.status(413).json({ error: "This recording is too large to transcribe." });

  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) return res.status(413).json({ error: "This recording is too large to transcribe." });
      chunks.push(chunk);
    }
    if (!size) return res.status(400).json({ error: "The recording was empty." });

    const extension = mime.includes("mp4") || mime.includes("m4a") ? "m4a"
      : mime.includes("ogg") ? "ogg"
      : mime.includes("wav") ? "wav"
      : mime.includes("mpeg") || mime.includes("mp3") ? "mp3"
      : mime.includes("webm") ? "webm" : "audio";
    const form = new FormData();
    form.append("file", new Blob([Buffer.concat(chunks)], { type: mime }), "grandma-recording." + extension);
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("language", "en");
    form.append("prompt", "Transcribe the speaker's spoken words in English. Preserve the speaker's wording and do not add commentary.");

    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      body: form
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Audio transcription failed", upstream.status, result);
      return res.status(502).json({ error: "The recording is safely saved, but its transcript could not be prepared yet." });
    }
    return res.status(200).json({ text: (result.text || "").trim() });
  } catch (error) {
    console.error("Audio transcription request failed", error);
    return res.status(500).json({ error: "The recording is safely saved, but transcription could not be completed." });
  }
};
