use crate::providers::AppSession;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

pub(crate) struct AppState {
    pub(crate) next_session_id: AtomicU64,
    pub(crate) next_profile_id: AtomicU64,
    pub(crate) sessions: Arc<Mutex<HashMap<u64, AppSession>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            next_session_id: AtomicU64::new(1),
            next_profile_id: AtomicU64::new(1),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
