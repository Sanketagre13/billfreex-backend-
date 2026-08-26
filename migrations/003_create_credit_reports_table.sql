CREATE TABLE IF NOT EXISTS credit_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  pan_number_encrypted VARBINARY(512) NOT NULL,
  report_data_encrypted MEDIUMBLOB NOT NULL,
  score SMALLINT NULL,
  bureau_status VARCHAR(32) NULL,
  crif_display_id VARCHAR(64) NULL,
  fetched_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_credit_reports_user_fetched (user_id, fetched_at DESC),
  CONSTRAINT fk_credit_reports_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
