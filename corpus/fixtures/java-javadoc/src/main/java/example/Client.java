package example;

/**
 * Read {@link Client#status} and call {@code Client#get}.
 */
public class Client {
    public int status;

    public String get(int id, String label) {
        return label;
    }

    /** Internal hook: {@link #secret()}. */
    private String secret() {
        return "";
    }

    /** Legacy call: {@link #legacy()}. */
    @Deprecated
    public void legacy() {}

    /** Inner entry point: {@link #run()}. */
    public class Inner {
        public String run() {
            return "";
        }
    }
}

/**
 * Other entry point: {@link #get(int, String)}.
 */
class Other {
    public String get(int id, String label) {
        return label;
    }

    /** Internal hook: {@link #secret()}. */
    private String secret() {
        return "";
    }

    /** Legacy call: {@link #legacy()}. */
    @Deprecated
    public void legacy() {}

    /** Inner entry point: {@link #run()}. */
    public class Inner {
        public String run() {
            return "";
        }
    }
}

/**
 * Internal entry point: {@link #check()}.
 */
class Internal {
    public void check() {}
}
