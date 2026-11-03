#[macro_export]
macro_rules! define_public {
    ($($name:ident),*) => {
        $( pub fn $name() -> u8 { 0 } )*
    };
}
