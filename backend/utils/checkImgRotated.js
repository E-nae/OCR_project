import sharp from 'sharp';

/**
 * 모든 환경에서 작동하는 간단한 이미지 회전 감지
 * Sharp의 자동 회전 + 간단한 이미지 분석 사용
 */

// 간단한 회전 감지 (EXIF + 이미지 분석)
async function simpleRotationCheck(imagePath) {
  try {
    // 1. EXIF 메타데이터 확인
    const metadata = await sharp(imagePath).metadata();

    // EXIF orientation이 1이 아니면 회전이 필요
    if (metadata.orientation && metadata.orientation !== 1) {
      console.log(`EXIF orientation 감지: ${metadata.orientation}`);
      return true;
    }

    // 2. 이미지가 정사각형이 아닌 경우, 가로/세로 비율로 판단
    const { width, height } = metadata;

    if (!width || !height) {
      console.warn('이미지 크기 정보 없음');
      return false;
    }

    // 가로가 세로보다 훨씬 긴 경우 (가로 이미지)
    const aspectRatio = width / height;
    if (aspectRatio > 1.5) {
      console.log(
        `가로 이미지 감지: ${width}x${height} (비율: ${aspectRatio.toFixed(2)})`
      );
      return false; // 가로 이미지는 정상
    }

    // 세로가 가로보다 훨씬 긴 경우 (세로 이미지)
    if (aspectRatio < 0.7) {
      console.log(
        `세로 이미지 감지: ${width}x${height} (비율: ${aspectRatio.toFixed(2)})`
      );
      return false; // 세로 이미지는 정상
    }

    // 3. 정사각형에 가까운 경우, 텍스트 방향으로 판단
    if (aspectRatio >= 0.7 && aspectRatio <= 1.5) {
      // 정사각형에 가까운 이미지는 텍스트 방향으로 판단
      return await checkTextOrientation(imagePath);
    }

    return false;
  } catch (error) {
    console.error('회전 감지 실패:', error.message);
    return false; // 에러 발생 시 회전이 필요하지 않다고 가정
  }
}

// 텍스트 방향 확인 (간단한 버전)
async function checkTextOrientation(imagePath) {
  try {
    // 이미지를 작게 리사이즈하여 빠르게 처리
    const smallBuffer = await sharp(imagePath)
      .resize(200, 200, { fit: 'inside' })
      .grayscale()
      .toBuffer();

    // 가로와 세로 방향으로 이미지 분석
    const horizontal = await analyzeImageDirection(smallBuffer, 'horizontal');
    const vertical = await analyzeImageDirection(smallBuffer, 'vertical');

    console.log(`방향 분석 - 가로: ${horizontal}, 세로: ${vertical}`);

    // 가로 방향이 더 선명하면 정상, 세로 방향이 더 선명하면 회전 필요
    if (vertical > horizontal * 1.2) {
      console.log('세로 방향 텍스트 감지 - 회전 필요');
      return true;
    }

    return false;
  } catch (error) {
    console.warn('텍스트 방향 확인 실패:', error.message);
    return false;
  }
}

// 이미지 방향별 선명도 분석
async function analyzeImageDirection(buffer, direction) {
  try {
    let processedBuffer;

    if (direction === 'horizontal') {
      // 가로 방향으로 압축하여 가로 선 감지
      processedBuffer = await sharp(buffer)
        .resize(200, 50, { fit: 'fill' })
        .grayscale()
        .toBuffer();
    } else {
      // 세로 방향으로 압축하여 세로 선 감지
      processedBuffer = await sharp(buffer)
        .resize(50, 200, { fit: 'fill' })
        .grayscale()
        .toBuffer();
    }

    // 간단한 엣지 감지 (선명도 측정)
    const stats = await sharp(processedBuffer).stats();
    const stdev = stats.channels[0]?.stdev || 0;

    return stdev;
  } catch (error) {
    console.warn(`${direction} 방향 분석 실패:`, error.message);
    return 0;
  }
}

// 고급 회전 감지 (필요시 사용)
async function advancedRotationCheck(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();

    // 이미지가 너무 작으면 분석하지 않음
    if (metadata.width < 100 || metadata.height < 100) {
      return false;
    }

    // 여러 각도로 테스트하여 최적 각도 찾기
    const angles = [0, 90, 180, 270];
    const results = [];

    for (const angle of angles) {
      const rotatedBuffer = await sharp(imagePath)
        .rotate(angle)
        .resize(100, 100, { fit: 'inside' })
        .grayscale()
        .toBuffer();

      const stats = await sharp(rotatedBuffer).stats();
      const stdev = stats.channels[0]?.stdev || 0;

      results.push({ angle, stdev });
    }

    // 가장 선명한 각도 찾기
    const bestAngle = results.reduce((best, current) =>
      current.stdev > best.stdev ? current : best
    );

    console.log(
      `최적 각도: ${bestAngle.angle}도 (선명도: ${bestAngle.stdev.toFixed(2)})`
    );

    // 0도가 아니면 회전 필요
    return bestAngle.angle !== 0;
  } catch (error) {
    console.error('고급 회전 감지 실패:', error.message);
    return false;
  }
}

// 이미지 자동 회전 (EXIF 적용)
async function autoRotateImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .rotate() // EXIF orientation 자동 적용
      .toFile(outputPath);

    console.log('이미지 자동 회전 완료');
    return true;
  } catch (error) {
    console.error('이미지 자동 회전 실패:', error.message);
    return false;
  }
}

// 모든 함수를 export
export {
  simpleRotationCheck,
  advancedRotationCheck,
  autoRotateImage,
  checkTextOrientation,
};

// 기본 export로 simpleRotationCheck 설정
export default simpleRotationCheck;
