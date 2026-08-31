from supabase import create_client, Client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

_client: Client | None = None


def get_supabase() -> Client:
    """
    Server-side Supabase client using the SERVICE ROLE key.
    Only ever call this from backend code — never ship the service key to the frontend.
    The frontend uses its own Supabase client with the anon/public key for auth.
    """
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError(
                "SUPABASE_URL / SUPABASE_SERVICE_KEY not set. Fill them in backend/.env"
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client
