macro_rules! make_getter {
    ($name:ident) => {
        pub fn $name() -> u8 { 0 }
    };
}

macro_rules! make_public {
    ($vis:vis fn $name:ident()) => {
        $vis fn $name() -> u8 { 1 }
    };
}

make_getter!(generated);
make_public!(pub fn generated_public());
