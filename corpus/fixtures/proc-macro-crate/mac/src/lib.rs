use proc_macro::TokenStream;

#[proc_macro]
pub fn make_fn(_: TokenStream) -> TokenStream {
    "pub fn generated() -> u8 { 1 }".parse().unwrap()
}

#[proc_macro]
pub fn make_struct(_: TokenStream) -> TokenStream {
    "pub struct Generated { pub value: u8 }".parse().unwrap()
}
