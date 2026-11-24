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

## Family access and device sessions
- Supabase anonymous authentication creates a persistent session for each browser/device; no email or personal password is required.
- A device explicitly creates a family or joins through a shareable invitation link plus the family-wide joining password.
- The family owner sets a recovery question from suggested options or writes a custom question.
- Recovery can restore family ownership on a replacement device using the invitation link and the recovery answer.
- Family access credentials and recovery answers are stored as password hashes in the private database schema; invitation links contain high-entropy random tokens stored only as hashes.
- Local photo/story cache keys are namespaced by family ID so one family’s device cache is not reused for another family.
- Supabase refresh tokens are persisted by the browser client, so ordinary site deployments should not sign families out.

## Important setup and limitations
- Enable **Authentication → Providers → Anonymous Sign-Ins** in the Supabase dashboard before using the new onboarding flow.
- Existing signed-in family owners can open **Family settings** to set the first family password, recovery question, and invitation link.
- A device is associated with one family at a time. Use a separate browser profile/device to access a different family.
- Clearing browser data or losing a device removes its anonymous session. The family invitation link and recovery answer are then required to restore family access.
- Add CAPTCHA/Turnstile and monitor anonymous sign-in abuse before opening the product to broad public signup.
- Keep regular database and Storage backups; account recovery is not a substitute for backups.

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
