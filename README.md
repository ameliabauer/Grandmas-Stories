# Grandma's Stories

A photo-led family storytelling experience. The heart of the product is recreating the feeling of sitting together in a living room, opening an old box of photographs, and letting the pictures bring memories to the surface.

## Current milestone: family-first iPad experience
- Grandma-first responsive web app / PWA shell, retaining the approved mid-century living-room aesthetic.
- Opens directly into the family album without email sign-in or account setup.
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

## Design image credits

- Living-room photograph: Room AI, [Orange Sofa and Teal Cone Fireplace Lounge](https://roomai.com/ideas/orange-sofa-and-teal-cone-fireplace-lounge-1580).
- Turntable photograph: Samuel Regan-Asante, [Unsplash](https://unsplash.com/photos/black-vinyl-record-player-on-brown-wooden-table-ytOQrHL0V4w).


## Family-first access decision
- The current prototype is intended for one family and opens directly to the album.
- Email magic-link sign-in and first-family setup have been removed from the app's entry path because they blocked access and created unnecessary friction.
- Photos, recordings and transcripts continue to be stored in the existing local IndexedDB on this iPad. Existing local data is not cleared by this change.
- Supabase remains the planned foundation for a later private cloud archive, family invitations, backup and cross-device access. Those features are not yet implemented and should not be described as available.
