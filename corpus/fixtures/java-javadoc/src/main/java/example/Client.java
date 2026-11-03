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

    /** Helper: {@link #helper()}. */
    @SuppressWarnings("unused")
    public void helper() {}

    /** Command: {@link #command()}. */
    @Command(value = "run", retries = 2, nested = @Inner(level = 1))
    public void command() {}

    /** Routes: {@link #routes()}. */
    @Routes({"/a", "/b"})
    public void routes() {}

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

/**
 * Marker docs: {@link Marker#value()}, {@code Marker#count}, {@code Marker#flag}, and {@link Marker#tags()}.
 */
public @interface Marker {
    String value() default "default";

    int count() default 0;

    boolean flag() default true;

    String[] tags() default {"a", "b"};
}

/**
 * Colors: {@link Color#RED} and {@link Color#GREEN}.
 */
public enum Color {
    RED("red"),
    GREEN("green") {
        /** Label: {@link Color.GREEN#label()}. */
        public String label() {
            return "green";
        }
    }
}
