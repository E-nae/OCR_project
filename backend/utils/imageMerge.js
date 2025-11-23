import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, '..', 'temps', 'mojRefund', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'temps', 'mojRefund', 'uploads');

// 디렉토리 생성
[TEMP_DIR, UPLOAD_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 임시 파일 정리 함수 강화
const cleanupTempFiles = (tracker) => {
  try {
    if (tracker.tempDir && fs.existsSync(tracker.tempDir)) {
      fs.rmSync(tracker.tempDir, { recursive: true, force: true });
      console.log(`임시 디렉토리 정리 완료: ${tracker.tempDir}`);
    }
  } catch (e) {
    console.warn('임시 파일 정리 실패:', e.message);
  }
};

// 오래된 임시 파일들 정리 (전체 temp 폴더 스캔)
const cleanupAllOldTempFiles = (maxAge = 300000) => {
  // 5분
  try {
    if (!fs.existsSync(TEMP_DIR)) return;

    const now = Date.now();
    const tempDirs = fs.readdirSync(TEMP_DIR);

    tempDirs.forEach((dirName) => {
      const dirPath = path.join(TEMP_DIR, dirName);
      try {
        const stats = fs.statSync(dirPath);
        if (now - stats.mtime.getTime() > maxAge) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`오래된 임시 디렉토리 삭제: ${dirPath}`);
        }
      } catch (e) {
        console.warn(`임시 디렉토리 접근 실패: ${dirPath}`, e.message);
      }
    });
  } catch (e) {
    console.warn('전체 임시 파일 정리 실패:', e.message);
  }
};

// 오래된 업로드 추적 정보 정리
const cleanupOldUploads = (uploadTracker, maxAge = 300000) => {
  const now = Date.now();
  Object.entries(uploadTracker).forEach(([sid, tracker]) => {
    if (tracker.startTime && now - tracker.startTime > maxAge) {
      cleanupTempFiles(tracker);
      delete uploadTracker[sid];
      console.log(`오래된 업로드 세션 정리: ${sid}`);
    }
  });
};

const imageMerge = async (
  FILENAME,
  SID,
  chunkData,
  chunkIndex,
  totalChunks,
  uploadTracker
) => {
  // 빠른 입력 검증
  if (!FILENAME || !SID || !chunkData || chunkIndex < 0 || totalChunks <= 0) {
    throw new Error('잘못된 파라미터');
  }

  // 세션 초기화 - 없으면 생성, 있으면 재사용
  if (!uploadTracker[SID]) {
    console.log(`새 세션 생성: ${SID}`);

    uploadTracker[SID] = {
      chunks: new Array(totalChunks).fill(null),
      received: 0,
      total: totalChunks,
      tempDir: path.join(TEMP_DIR, SID),
      startTime: Date.now(), // 시작 시간 추가
    };

    // 임시 디렉토리 생성 (기존 정리 후)
    try {
      if (fs.existsSync(uploadTracker[SID].tempDir)) {
        fs.rmSync(uploadTracker[SID].tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(uploadTracker[SID].tempDir, { recursive: true });
    } catch (e) {
      console.warn(`디렉토리 준비 실패: ${e.message}`);
      // 에러 발생 시 임시 파일 정리 시도
      cleanupTempFiles(uploadTracker[SID]);
      throw e;
    }
  } else {
    // 기존 세션 검증 - totalChunks가 다르면 새로 시작
    if (uploadTracker[SID].total !== totalChunks) {
      console.log(`청크 수 변경으로 세션 재시작: ${SID}`);
      try {
        if (
          uploadTracker[SID].tempDir &&
          fs.existsSync(uploadTracker[SID].tempDir)
        ) {
          fs.rmSync(uploadTracker[SID].tempDir, {
            recursive: true,
            force: true,
          });
        }
      } catch (e) {
        console.warn(`기존 세션 정리 실패: ${e.message}`);
      }

      uploadTracker[SID] = {
        chunks: new Array(totalChunks).fill(null),
        received: 0,
        total: totalChunks,
        tempDir: path.join(TEMP_DIR, SID),
        startTime: Date.now(), // 시작 시간 추가
      };

      fs.mkdirSync(uploadTracker[SID].tempDir, { recursive: true });
    }
  }

  const tracker = uploadTracker[SID];

  // 중복 청크 체크 및 처리
  if (tracker.chunks[chunkIndex]) {
    console.log(`중복 청크 ${chunkIndex} 무시`);
    return; // 중복이면 그냥 리턴
  }

  // 청크 저장
  const chunkPath = path.join(tracker.tempDir, `${chunkIndex}.tmp`);
  try {
    fs.writeFileSync(chunkPath, chunkData);
  } catch (e) {
    console.error(`청크 저장 실패: ${e.message}`);
    // 청크 저장 실패 시 임시 파일 정리
    cleanupTempFiles(tracker);
    throw e;
  }

  tracker.chunks[chunkIndex] = chunkPath;
  tracker.received++;

  console.log(
    `청크 ${chunkIndex} 저장완료. 진행률: ${tracker.received}/${tracker.total}`
  );

  // 모든 청크 완료 체크
  if (tracker.received === tracker.total) {
    console.log(`=== 모든 청크 완료! 병합 시작 ===`);
  } else {
    console.log(`대기중... ${tracker.received}/${tracker.total}`);
    return; // 아직 미완료
  }

  // 파일 병합 (스트림 없이 직접 버퍼 조합)
  const timestamp = Date.now();
  const ext = path.extname(FILENAME);
  const name = path.basename(FILENAME, ext);
  const finalPath = path.join(UPLOAD_DIR, `${name}_${timestamp}${ext}`);

  // 모든 청크를 메모리에서 병합
  const buffers = [];
  let totalSize = 0;

  try {
    for (let i = 0; i < tracker.total; i++) {
      if (!tracker.chunks[i] || !fs.existsSync(tracker.chunks[i])) {
        throw new Error(`청크 ${i} 누락`);
      }
      const chunkBuffer = fs.readFileSync(tracker.chunks[i]);
      buffers.push(chunkBuffer);
      totalSize += chunkBuffer.length;
    }

    console.log(
      `${buffers.length}개 청크 병합 중... 총 크기: ${totalSize} bytes`
    );

    // 단일 쓰기로 파일 생성
    fs.writeFileSync(finalPath, Buffer.concat(buffers));

    console.log(`파일 생성 완료: ${finalPath}`);
  } catch (e) {
    console.error(`파일 병합 실패: ${e.message}`);
    // 병합 실패 시 임시 파일 정리
    cleanupTempFiles(tracker);
    throw e;
  }

  // 성공적으로 완료된 후 임시 파일 정리
  try {
    cleanupTempFiles(tracker);
    console.log(`임시 파일 정리 완료: ${SID}`);
  } catch (e) {
    console.warn(`임시 파일 정리 실패: ${e.message}`);
  }

  // 완료 확인 및 정리
  delete uploadTracker[SID];
  console.log(`업로드 완료, SID 삭제: ${SID}`);
  return finalPath;
};

export default imageMerge;
export {
  cleanupTempFiles,
  cleanupOldUploads,
  cleanupAllOldTempFiles,
};
