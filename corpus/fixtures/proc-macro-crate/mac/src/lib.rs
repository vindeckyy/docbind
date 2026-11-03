use proc_macro::TokenStream;

#[proc_macro]
pub fn make_fn(_: TokenStream) -> TokenStream {
    "pub fn generated() -> u8 { 1 }".parse().unwrap()
}
