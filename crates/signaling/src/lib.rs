#![doc = "Room and signaling service for OpenMeet."]
#![doc = ""]
#![doc = "Rooms are in-memory and ephemeral; media never transits this service."]

pub mod http;
pub mod livekit;
pub mod protocol;
pub mod room;
pub mod schedule;

pub use http::{router, AppState};
pub use room::{Config, Hub};
