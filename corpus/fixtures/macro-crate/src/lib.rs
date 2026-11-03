mod macros;

crate::define_public!(generated, generated_public);
crate::define_nested!(nested_one, nested_two; nested_three);

#[derive(Clone, Default)]
pub struct Config {
    pub name: String,
}
