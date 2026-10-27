-- Music Intelligence Dashboard — MySQL schema
-- Run with: mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS music_intelligence
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE music_intelligence;

CREATE TABLE IF NOT EXISTS artists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  spotify_artist_id VARCHAR(64) UNIQUE,
  name VARCHAR(255) NOT NULL,
  popularity INT DEFAULT 0,
  genres VARCHAR(512),
  image_url VARCHAR(1024),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS albums (
  id INT AUTO_INCREMENT PRIMARY KEY,
  spotify_album_id VARCHAR(64) UNIQUE,
  artist_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  release_date DATE,
  image_url VARCHAR(1024),
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tracks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  spotify_track_id VARCHAR(64) UNIQUE,
  artist_id INT NOT NULL,
  album_id INT,
  name VARCHAR(255) NOT NULL,
  release_date DATE,
  duration_ms INT,
  popularity INT DEFAULT 0,
  genre VARCHAR(128),
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS youtube_videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  video_id VARCHAR(32) UNIQUE NOT NULL,
  artist_id INT,
  track_id INT,
  title VARCHAR(512),
  channel VARCHAR(255),
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  published_at DATE,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS youtube_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  video_id VARCHAR(32) NOT NULL,
  comment_text TEXT NOT NULL,
  published_at DATE,
  sentiment VARCHAR(16),
  sentiment_score FLOAT,
  topic VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_video (video_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS keywords (
  id INT AUTO_INCREMENT PRIMARY KEY,
  artist_id INT NOT NULL,
  keyword VARCHAR(255) NOT NULL,
  frequency INT DEFAULT 0,
  tfidf_score FLOAT DEFAULT 0,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS topics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  artist_id INT NOT NULL,
  topic_name VARCHAR(255),
  keywords VARCHAR(512),
  comment_count INT DEFAULT 0,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trend_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  artist_id INT NOT NULL,
  track_id INT,
  spotify_score FLOAT DEFAULT 0,
  youtube_growth FLOAT DEFAULT 0,
  engagement_score FLOAT DEFAULT 0,
  discussion_growth FLOAT DEFAULT 0,
  trend_score FLOAT DEFAULT 0,
  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;
