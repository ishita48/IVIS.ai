# 13-mongodb

A student's sessions, source notes, and event history can persist between visits
through MongoDB. LENS computes hint counts, voice turns, and vision latency from
stored events and reasoning state, reading MongoDB when Elastic is not primary
or its metrics read fails. The MongoDB connection helper pauses retries for
60 seconds after a failed connection.

**Lives in:** `apps/lens/lib/mongodb.ts`, `apps/lens/lib/db-setup.ts`, `apps/lens/lib/metrics.ts`
