variable "db_url" {
  type    = string
  default = "postgresql://postgres:postgres@localhost:5432/laneconductor?sslmode=disable"
}

env "local" {
  # Point to the SQL file generated from Prisma + Cloud Additions + RLS adjustments
  src = ["file://prisma/schema.sql", "file://cloud/schema.sql", "file://prisma/rls.sql"]
  
  # URL of the project database
  url = var.db_url
  
  # Dev database for migration planning
  dev = "postgresql://postgres:postgres@localhost:5432/laneconductor_dev?sslmode=disable"
  
  migration {
    dir = "file://migrations"
  }
}

env "remote" {
  src = ["file://prisma/schema.sql", "file://cloud/schema.sql", "file://prisma/rls.sql"]
  url = var.db_url
  dev = "postgresql://postgres:postgres@localhost:5432/laneconductor_dev?sslmode=disable"
  
  migration {
    dir = "file://migrations"
    revisions_schema = "public"
  }
}
