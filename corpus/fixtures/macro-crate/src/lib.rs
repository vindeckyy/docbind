mod macros;

crate::define_public!(generated, generated_public);

#[derive(Clone, Default)]
pub struct Config {
    pub name: String,
}
