import { createServerSupabaseClient } from './server';

type AdminProfile = {
  cargo: string | null;
};

export async function getCurrentAdminState() {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return { isAdmin: false, email: null };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { isAdmin: false, email: null };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('cargo')
    .eq('id', user.id)
    .maybeSingle<AdminProfile>();

  return {
    isAdmin: !error && data?.cargo === 'admin',
    email: user.email ?? null,
  };
}
