pub struct Client {
    pub base: String,
}

impl Client {
    pub fn request(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }
}

pub enum Mode {
    Fast,
    Safe,
}

pub fn get_user(id: u32) -> String {
    id.to_string()
}
