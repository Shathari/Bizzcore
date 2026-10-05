-- Historical rows remain NULL: their original date-input semantics are unknown.
ALTER TABLE "Purchase" ADD COLUMN "requestFingerprint" TEXT;
