import { createClient } from "@supabase/supabase-js"

const superbaseUrl = "https://gynwghyrhkbgudtphdmm.supabase.co"
const superbaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bndnaHlyaGtiZ3VkdHBoZG1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYyMDcwNzksImV4cCI6MjA3MTc4MzA3OX0.NPx2SxlXorZQSZYOFO2BqpCRCtQPMRya1DrbGN1QBBs"

export const supabase = createClient(superbaseUrl, superbaseAnonKey)