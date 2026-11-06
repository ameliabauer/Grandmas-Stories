<img width="1672" height="941" alt="image" src="https://github.com/user-attachments/assets/bd2f75ff-9df1-407b-b5b9-4991a383250f" />


# Grandma's Stories

A photo-led family storytelling experience. The heart of the product is recreating the feeling of sitting together in a living room, opening an old box of photographs, and letting the pictures bring memories to the surface.

## Current milestone: photo-led iPad prototype
- Grandma-first responsive web app / PWA shell.
- A family photo album with image upload, one-photo-at-a-time viewing, and optional family context.
- The selected photograph is shown throughout the conversation and sent as visual context to the Realtime session.
- Conversational guidance asks the AI to describe only what is visibly present, avoid guessing identities or facts, and let Grandma lead the memory.
- Plain-language AI and recording consent before microphone use.
- OpenAI Realtime WebRTC session proxy (API key remains server-side).
- Local audio recording and transcript stored with the photograph reference in IndexedDB.
- Large touch controls, explicit stop, and eight-minute session cap.

## Important limitations
This milestone stores photographs, recordings, and transcripts on the same iPad only. There is no secure family login, remote upload, cross-device sync, cloud archive, backup, or family sharing yet. Do not treat it as a permanent preservation archive until those features and recovery/export/delete flows are complete and tested.

The photo album is intentionally local for this first photo-led interaction prototype. The next milestone is a secure family web portal so relatives can upload and curate photographs remotely, with those photographs delivered privately to Grandma's iPad.

## Environment
Set OPENAI_API_KEY in the Vercel project. Optional: REALTIME_MODEL, REALTIME_VOICE.

## Run
npm install && npm run dev

## Roadmap
1. Complete live photo + voice session testing on a physical iPad, including confirmation that the Realtime model accepts image input.
2. Build secure family authentication and remote photo upload/curation.
3. Add private cloud storage and story/photo APIs; synchronize sessions and family archive across devices.
4. Add durable offline upload queue, duplicate protection, backups, export and deletion.
5. Run accessibility, privacy, reliability and family acceptance tests.
