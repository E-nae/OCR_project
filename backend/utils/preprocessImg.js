import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// 이미지 분석 함수
export async function analyzeImage(imagePath) {
  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const stats = await image.stats();

    console.log('=== 이미지 분석 ===');
    console.log(`크기: ${metadata.width}x${metadata.height}`);
    console.log(`포맷: ${metadata.format}`);
    console.log(`채널: ${metadata.channels}`);

    const brightness =
      stats.channels && stats.channels[0] ? stats.channels[0].mean : 0;
    const contrast =
      stats.channels && stats.channels[0] ? stats.channels[0].stdev : 0;

    console.log(`평균 밝기: ${brightness.toFixed(1)}`);
    console.log(`표준편차: ${contrast.toFixed(1)}`);

    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      channels: metadata.channels,
      brightness,
      contrast,
    };
  } catch (error) {
    console.error('이미지 분석 오류:', error);
    return null;
  }
}

// 고대비 전처리 함수 (테스트에서 최적으로 확인된 방법)
export async function highContrastPreprocess(inputPath, outputPath = null) {
  try {
    console.log('고대비 전처리 시작...');

    if (!outputPath) {
      const parsedPath = path.parse(inputPath);
      outputPath = path.join(
        parsedPath.dir,
        `processed_${parsedPath.name}.png`
      );
    }

    // 이미지 분석
    const analysis = await analyzeImage(inputPath);
    if (!analysis) throw new Error('이미지 분석 실패');

    // 동적 리사이징 크기 결정
    const targetWidth = Math.max(2500, analysis.width * 1.5);

    await sharp(inputPath)
      .resize(targetWidth, null, {
        fit: 'inside',
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: false,
      })
      .greyscale()
      .normalize() // 히스토그램 정규화
      .linear(2.5, -100) // 강한 대비 증가
      .threshold(120) // 이진화
      .png({ quality: 100, compressionLevel: 0 })
      .toFile(outputPath);

    console.log(`고대비 전처리 완료: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('고대비 전처리 오류:', error);
    throw error;
  }
}

// 다중 전처리 방식 생성
export async function createMultiplePreprocessed(inputPath) {
  const results = [];
  const parsedPath = path.parse(inputPath);

  try {
    // 이미지 분석
    const analysis = await analyzeImage(inputPath);
    if (!analysis) throw new Error('이미지 분석 실패');

    console.log('다중 전처리 방식 생성 중...');

    const basicPath = path.join(
      parsedPath.dir,
      `basic_${Date.now()}_${parsedPath.name}.png`
    );
    let image = sharp(inputPath)
      .resize(2100, null, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .greyscale()
      .normalize()
      .sharpen();

    // 조건에 따라 명시적으로 linear 적용
    if (analysis.brightness < 160) {
      image = image.linear(2.2, -100).threshold(120); // 어두우면 대비 강화
    }
    await image.png({ quality: 100, compressionLevel: 0 }).toFile(basicPath);

    results.push({ path: basicPath, type: 'basic' });

    return results;
  } catch (error) {
    // 오류 시 생성된 파일들 정리
    for (const result of results) {
      if (result.path !== inputPath && fs.existsSync(result.path)) {
        try {
          fs.unlinkSync(result.path);
        } catch (e) {
          console.warn('파일 삭제 실패:', e.message);
        }
      }
    }
    throw error;
  }
}

export default createMultiplePreprocessed;
