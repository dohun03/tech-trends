import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrendSortIndexes1789888000000 implements MigrationInterface {

  name = 'AddTrendSortIndexes1789888000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 목록 정렬(LIKE_DESC/VIEW_DESC/COMMENT_DESC)용 복합 인덱스.
    // 기존에는 like_count/view_count/comment_count 에 인덱스가 없어
    // 전체 Seq Scan + Sort(18.7ms @50k)가 발생했음 → Index Scan(0.1~0.5ms)으로 전환.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tech_trends_like_created"
      ON "tbl_tech_trends" ("like_count" DESC NULLS LAST, "created_at" DESC, "id" DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tech_trends_view_created"
      ON "tbl_tech_trends" ("view_count" DESC NULLS LAST, "created_at" DESC, "id" DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tech_trends_comment_created"
      ON "tbl_tech_trends" ("comment_count" DESC NULLS LAST, "created_at" DESC, "id" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tech_trends_comment_created";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tech_trends_view_created";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tech_trends_like_created";`);
  }
}