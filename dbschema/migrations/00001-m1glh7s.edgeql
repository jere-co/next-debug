CREATE MIGRATION m1glh7sp5pqgnd3utdaocrnkqhb7dtcmos265724jnb4mvgllh5poq
    ONTO initial
{
  CREATE FUTURE simple_scoping;
  CREATE TYPE default::Post {
      CREATE REQUIRED PROPERTY slug: std::str {
          CREATE CONSTRAINT std::exclusive;
      };
      CREATE INDEX ON (.slug);
      CREATE REQUIRED PROPERTY title: std::str {
          CREATE CONSTRAINT std::exclusive;
      };
  };
};
