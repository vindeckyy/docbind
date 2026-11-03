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

#[macro_export]
macro_rules! define_grouped {
    ($($group:ident { $($left:ident : $left_ty:ty),* } -> { $($right:ident : $right_ty:ty),* }),*) => {
        $(
            pub mod $group {
                $( pub fn $left() -> $left_ty { loop {} } )*
                $( pub fn $right() -> $right_ty { loop {} } )*
            }
        )*
    };
}

macro_rules! private_make {
    ($name:ident) => {
        pub fn $name() -> u8 { 4 }
    };
}

macro_rules! make_optional {
    ($vis:vis fn $name:ident($($arg:ident)?) $(-> $ret:ty)?) => {
        $vis fn $name($($arg)?) $(-> $ret)? { loop {} }
    };
}
