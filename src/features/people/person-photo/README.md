# Person photos

Private diver portraits use preallocated opaque object keys, a durable upload record, and current-reference checks on every read. A delivered readiness capability identifies a diver for self-service; staff access is scoped to live shop membership. The upload record is staged before the PUT, published under the person lock, and retired with the reference change. Cleanup repeatedly purges retired keys because a timed-out PUT can complete late.
