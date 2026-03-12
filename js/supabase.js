import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = 'https://sqvmbirikyrxldqzvthl.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxdm1iaXJpa3lyeGxkcXp2dGhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMTcwNTQsImV4cCI6MjA4ODg5MzA1NH0.N2n8xPtGSL9JPs55-Z5sIR4L3yu8WU6WEMwZ6TqrvuQ'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)