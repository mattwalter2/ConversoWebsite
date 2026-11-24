-- Phase 2 (voice): private bucket for Mateo's generated audio, one mp3 per tutor message at
-- <user_id>/<message_id>.mp3. Only Edge Functions (service role) read/write it; the browser gets
-- short-lived signed URLs, so no storage policies are needed for users.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tts', 'tts', false, 5242880, array['audio/mpeg'])
on conflict (id) do nothing;
