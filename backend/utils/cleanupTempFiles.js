import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, '..', 'temps', 'mojRefund', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'temps', 'mojRefund', 'uploads');

/**
 * 임시 파일들을 정리하는 함수들
 */

// 특정 SID의 임시 파일들 정리
export const cleanupTempFilesBySID = (sid) => {
  try {
    const tempDirPath = path.join(TEMP_DIR, sid);
    if (fs.existsSync(tempDirPath)) {
      fs.rmSync(tempDirPath, { recursive: true, force: true });
      console.log(`SID ${sid}의 임시 파일 정리 완료`);
      return true;
    } else {
      console.log(`SID ${sid}의 임시 디렉토리가 존재하지 않음`);
      return false;
    }
  } catch (error) {
    console.error(`SID ${sid} 임시 파일 정리 실패:`, error.message);
    return false;
  }
};

// 모든 임시 파일들 정리
export const cleanupAllTempFiles = () => {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      console.log('임시 디렉토리가 존재하지 않음');
      return { success: true, deletedCount: 0 };
    }

    const tempDirs = fs.readdirSync(TEMP_DIR);
    let deletedCount = 0;

    tempDirs.forEach((dirName) => {
      const dirPath = path.join(TEMP_DIR, dirName);
      try {
        if (fs.statSync(dirPath).isDirectory()) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          deletedCount++;
          console.log(`임시 디렉토리 삭제: ${dirPath}`);
        }
      } catch (error) {
        console.warn(`디렉토리 삭제 실패: ${dirPath}`, error.message);
      }
    });

    console.log(`총 ${deletedCount}개의 임시 디렉토리 정리 완료`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error('전체 임시 파일 정리 실패:', error.message);
    return { success: false, error: error.message };
  }
};

// 오래된 임시 파일들만 정리 (기본값: 5분 이상)
export const cleanupOldTempFiles = (maxAgeMs = 300000) => {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      console.log('임시 디렉토리가 존재하지 않음');
      return { success: true, deletedCount: 0 };
    }

    const now = Date.now();
    const tempDirs = fs.readdirSync(TEMP_DIR);
    let deletedCount = 0;

    tempDirs.forEach((dirName) => {
      const dirPath = path.join(TEMP_DIR, dirName);
      try {
        const stats = fs.statSync(dirPath);
        if (stats.isDirectory() && now - stats.mtime.getTime() > maxAgeMs) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          deletedCount++;
          console.log(
            `오래된 임시 디렉토리 삭제: ${dirPath} (${Math.round(
              (now - stats.mtime.getTime()) / 1000
            )}초 전)`
          );
        }
      } catch (error) {
        console.warn(`디렉토리 접근 실패: ${dirPath}`, error.message);
      }
    });

    console.log(`총 ${deletedCount}개의 오래된 임시 디렉토리 정리 완료`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error('오래된 임시 파일 정리 실패:', error.message);
    return { success: false, error: error.message };
  }
};

// 임시 파일 상태 확인
export const getTempFilesStatus = () => {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      return { exists: false, count: 0, details: [] };
    }

    const tempDirs = fs.readdirSync(TEMP_DIR);
    const details = [];

    tempDirs.forEach((dirName) => {
      const dirPath = path.join(TEMP_DIR, dirName);
      try {
        const stats = fs.statSync(dirPath);
        if (stats.isDirectory()) {
          const files = fs.readdirSync(dirPath);
          details.push({
            sid: dirName,
            path: dirPath,
            created: stats.birthtime,
            modified: stats.mtime,
            fileCount: files.length,
            size: files.reduce((total, file) => {
              try {
                const filePath = path.join(dirPath, file);
                const fileStats = fs.statSync(filePath);
                return total + fileStats.size;
              } catch {
                return total;
              }
            }, 0),
          });
        }
      } catch (error) {
        console.warn(`디렉토리 정보 읽기 실패: ${dirPath}`, error.message);
      }
    });

    return {
      exists: true,
      count: details.length,
      totalSize: details.reduce((sum, dir) => sum + dir.size, 0),
      details,
    };
  } catch (error) {
    console.error('임시 파일 상태 확인 실패:', error.message);
    return { exists: false, count: 0, details: [], error: error.message };
  }
};

// CLI에서 직접 실행할 때 사용
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  switch (command) {
    case 'clean-all':
      console.log('모든 임시 파일 정리 시작...');
      cleanupAllTempFiles();
      break;

    case 'clean-old':
      const maxAge = process.argv[3] ? parseInt(process.argv[3]) : 300000;
      console.log(`${maxAge / 1000}초 이상 된 임시 파일 정리 시작...`);
      cleanupOldTempFiles(maxAge);
      break;

    case 'status':
      console.log('임시 파일 상태 확인...');
      const status = getTempFilesStatus();
      console.log(JSON.stringify(status, null, 2));
      break;

    case 'clean-sid':
      const sid = process.argv[3];
      if (!sid) {
        console.log('사용법: node cleanupTempFiles.js clean-sid <SID>');
        process.exit(1);
      }
      console.log(`SID ${sid}의 임시 파일 정리 시작...`);
      cleanupTempFilesBySID(sid);
      break;

    default:
      console.log(`
사용법:
  node cleanupTempFiles.js <command> [options]
  
명령어:
  clean-all     - 모든 임시 파일 정리
  clean-old     - 오래된 임시 파일 정리 (기본: 5분 이상)
  clean-old <ms> - 지정된 시간(밀리초) 이상 된 임시 파일 정리
  clean-sid <sid> - 특정 SID의 임시 파일 정리
  status        - 임시 파일 상태 확인
  
예시:
  node cleanupTempFiles.js clean-all
  node cleanupTempFiles.js clean-old 600000  # 10분 이상
  node cleanupTempFiles.js clean-sid abc123
  node cleanupTempFiles.js status
      `);
  }
}
