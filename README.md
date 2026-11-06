# Grandma's Stories

A voice-first storytelling experience designed around dignity, consent, accessibility and family preservation.

## Current milestone
- Grandma-first responsive web app / PWA shell
- Plain-language AI and recording consent before microphone use
- OpenAI Realtime WebRTC session proxy (API key remains server-side)
- Local audio recording and IndexedDB save
- Large touch controls, spoken conversation, transcript captions, explicit stop and eight-minute session cap

## Important limitation
This first iteration stores recordings and transcripts on the same iPad only. It does not yet provide secure cross-device family backup. Do not treat it as a preservation archive until private cloud storage, authentication, backups, and export/delete flows are complete and tested.

## Environment
Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. Optional: `REALTIME_MODEL`, `REALTIME_VOICE`, and `GRANDMA_NAME`.

## Run
`npm install && npm run dev`

## Production roadmap
1. Complete live voice and iPad testing.
2. Provision private object storage and relational data; implement secure family authentication and story/photo endpoints.
3. Add a private photo queue and non-leading image-context handling.
4. Implement durable offline upload queue, duplicate protection, backups, export and deletion.
5. Run accessibility, privacy, reliability and real-user acceptance tests.
