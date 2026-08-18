-- diveday:allow-destructive drop-column courses.is_private: course privacy belongs to each trip instance, not the course definition
ALTER TABLE "courses" DROP COLUMN "is_private";
