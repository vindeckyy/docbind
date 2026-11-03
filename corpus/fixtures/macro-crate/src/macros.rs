#[macro_export]
macro_rules! define_public {
    ($($name:ident),*) => {
        $( pub fn $name() -> u8 { 0 } )*
    };
}

#[macro_export]
macro_rules! define_nested {
    ($($($name:ident),*);*) => {
        $( $( pub fn $name() -> u8 { 2 } )* )*
    };
}
