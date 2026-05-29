import { createServerSupabaseClient } from './server';

type AdminProfile = {
  cargo: string | null;
};

export async function getCurrentAdminState() {
  const context = await getCurrentAdminContext();

  return {
    isAdmin: context.isAdmin,
    email: context.email,
  };
}

export async function getCurrentAdminContext() {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return { isAdmin: false, email: null, userId: null, accessToken: null, supabase: null };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { isAdmin: false, email: null, userId: null, accessToken: null, supabase };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { data, error } = await supabase
    .from('profiles')
    .select('cargo')
    .eq('id', user.id)
    .maybeSingle<AdminProfile>();

  return {
    isAdmin: !error && data?.cargo === 'admin',
    email: user.email ?? null,
    userId: user.id,
    accessToken: session?.access_token ?? null,
    supabase,
  };
}
