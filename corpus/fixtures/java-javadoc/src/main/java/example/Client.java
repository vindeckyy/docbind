package example;

/**
 * Read {@link Client#status} and call {@code Client#get}.
 */
public class Client {
    public int status;

    public String get(int id, String label) {
        return label;
    }
}

/**
 * Other entry point: {@link #get(int, String)}.
 */
public class Other {
    public String get(int id, String label) {
        return label;
    }
}
