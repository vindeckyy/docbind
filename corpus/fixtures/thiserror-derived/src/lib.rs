use thiserror::Error;

#[derive(Error, Debug)]
#[error("inner")]
pub struct Inner;

#[derive(Error, Debug)]
#[error("outer")]
pub struct Outer {
    #[source]
    pub inner: Inner,
}
