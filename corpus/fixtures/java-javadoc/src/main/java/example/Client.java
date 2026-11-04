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
 * Marker docs: {@link Marker#value()}, {@code Marker#count}, {@code Marker#flag}, {@link Marker#tags()},
 * {@link Marker#fromConstant()}, {@link Marker#fromShared()}, {@link Marker#arithmetic()},
 * {@link Marker#intDiv()}, {@link Marker#halfConstant()}, {@link Marker#widened()},
 * {@link Marker#castDiv()}, {@link Marker#flags()}, {@link Marker#wide()},
 * {@link Marker#maxDefault()}, {@link Marker#rounded()}, and {@link Marker#root()}.
 */
public @interface Marker {
    String value() default "default";

    int count() default 0;

    boolean flag() default true;

    String[] tags() default {"a", "b"};

    String fromConstant() default Constants.NAME;

    String fromShared() default SharedConstants.NAME;

    int arithmetic() default 5 + 2;

    int intDiv() default 7 / 2;

    int halfConstant() default Constants.HALF;

    double widened() default Constants.WIDENED;

    double castDiv() default (double) 7 / 2;

    int flags() default 6 & 3;

    long wide() default 1L << 40;

    int maxDefault() default Math.max(3, 7);

    int rounded() default (int) Math.round(3.6);

    double root() default Math.sqrt(16);
}

class Constants {
    static final String NAME = "named";
    static final int HALF = 7 / 2;
    static final double WIDENED = 7 / 2;
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
