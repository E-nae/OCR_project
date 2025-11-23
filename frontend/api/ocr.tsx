import axios from 'axios';

const PATH_KEY = import.meta.env.VITE_FILE_UPLOAD_OCR_PATH;

interface Payload {
  IMG_PATH: string;
}

const ocr = async (data: Payload) => {
  try {
    const response = await axios.post(`${PATH_KEY}`, data);

    // console.log('ocr response: ');
    // console.log(response.data);

    if (!response.data.validity) {
      console.log('OCR 에러: ', response.data.data.message);
      return {
        validity: 'false',
        data: { DATA: null, FNM: '', message: 'OCR 실패' },
      };
    }

    return response.data;
  } catch (error) {
    console.log('OCR 에러: ', error);
    return {
      validity: 'false',
      data: { DATA: null, FNM: '', message: 'OCR 실패: ' + error },
    };
  }
};

export default ocr;
