package example;

/**
 * Read {@link Client#status} and call {@code Client#get}.
 */
public class Client {
    public int status;

    public String get(int id, String label) {
        return label;
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
public class Other {
    public String get(int id, String label) {
        return label;
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
