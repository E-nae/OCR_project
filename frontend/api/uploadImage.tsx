import axios, { AxiosPromise, AxiosResponse } from 'axios';
import { generateTUID } from '@utils/generateTUID';
import { header } from '@/config/header';

interface PAYLOAD {
  KEY: string;
  TYPE?: string;
  TUID?: string;
  PATH_KEY: string;
}
// 파일 청크 타입 정의
type FileChunk = Blob;

// 응답 타입 정의 (예시: 서버에서 반환하는 구조에 맞게 수정)
interface UploadResponse {
  validity: string;
  data: {
    DATA:
      | string
      | null
      | { FINISHED: string; FNM: string; FPATH: string; IDX: string };
    FNM: string | null | undefined;
    message: string | null;
  };
}
const tuid = generateTUID();
console.log('tuid: ', tuid);

export const uploadFIle = async (file: File, payload: PAYLOAD) => {
  try {
    // const PATH_KEY = process.env[`REACT_APP_FILE_UPLOAD_${payload?.KEY}_PATH`];
    // const PATH_KEY = import.meta.env.VITE_FILE_UPLOAD_PATH;
    const PATH_KEY = payload.PATH_KEY;

    // 파일을 청크로 나누는 함수
    const splitFileIntoChunks = (file: File) => {
      const chunks = [];
      const CHUNK_SIZE = 1024 * 1024 * 2; // 2MB씩 전송
      // const CHUNK_SIZE = file?.size / 3;
      const FILE_SIZE = file?.size;
      let start = 0;

      while (start < FILE_SIZE) {
        const end = Math.min(start + CHUNK_SIZE, FILE_SIZE);
        const chunk = file?.slice(start, end); // 파일을 start부터 end까지 잘라냄
        chunks.push(chunk);
        start = end;
      }

      return chunks;
    };

    const requests: AxiosPromise<UploadResponse>[] = [];
    const TUID: string = generateTUID();
    payload.TUID = TUID;
    const chunks: FileChunk[] = splitFileIntoChunks(file);

    const headers = header('multipart/form-data', 1, 'POST', TUID);

    /** 청크 수만큼 파일 전송 */
    chunks.forEach((chunk: FileChunk, idx: number) => {
      const formData = new FormData();
      formData.append('CHUNK', chunk, `${file.name}.part${idx}`);
      formData.append('CHUNK_IDX', idx.toString());
      formData.append('CHUNK_TOTAL', chunks.length.toString());
      formData.append('FILENAME', file.name);
      formData.append('PAYLOAD', JSON.stringify(payload));

      requests.push(
        axios.post<UploadResponse>(PATH_KEY, formData, {
          headers,
        })
      );
    });

    const responses: AxiosResponse<UploadResponse>[] = await Promise.all(
      requests
    );

    let res = null;
    /** 처음 이미지를 노드 서버로 업로드 - 성공한 응답만 전송 */
    if (payload.KEY === 'UPLOAD') {
      responses.forEach((response) => {
        const validity = response?.data?.validity;
        if (validity === 'true') {
          res = response.data;
        } else {
          console.log('이미지 전송 결과: ');
          console.log(response.data.data);
        }
      });
    } else {
      /** 이미지를 클라우드 서버 DB에 저장 - 완성된 응답만 받기 */
      responses.forEach((response) => {
        const result = response?.data.data.DATA;
        if (typeof result === 'object' && result?.FINISHED === 'Y') {
          res = response.data;
        }
      });
    }

    console.log('upload response: ');
    console.log(res);
    return res;
  } catch (err) {
    console.log('이미지 업로드 요청 실패: ', err);
    return {
      validity: 'false',
      data: { DATA: null, FNM: '', message: '이미지 업로드 요청 실패' },
    };
  }
};
