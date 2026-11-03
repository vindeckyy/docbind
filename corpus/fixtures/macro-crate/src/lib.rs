mod macros;

crate::define_public!(generated, generated_public);
crate::define_nested!(nested_one, nested_two; nested_three);
crate::define_grouped!(
    alpha { one: u8, two: u16 } -> { three: u32 },
    beta { four: u64 } -> { five: u8, six: u16 }
);

#[derive(Clone, Default)]
pub struct Config {
    pub name: String,
}
