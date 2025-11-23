/*********************************** 환불 신청 ***********************************/
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import DBSave from '../../controller/saveDB.js';
import cors from 'cors';
const router = express.Router();

const corsOptions = {
  origin: '*',
  credentials: false, 
  methods: ['GET', 'POST'],
  allowedHeaders: ['*'],
};

router.options('/apply', cors(corsOptions));
router.post('/apply', cors(corsOptions), async (req, res) => {
  try {
    const DATA = req.body;

    const SID = req.header('TUID'); 

    if (
      !DATA.NAME ||
      !DATA.TUID ||
      !DATA.TEL ||
      !DATA.ACCOUNT ||
      !DATA.BANK ||
      !DATA.ACCOUNTHOLDER ||
      !SID
    ) {
      return res.send({
        validity: false,
        data: {
          DATA: null,
          FNM: '',
          message: '필수 입력값이 누락되었습니다.',
        },
      });
    }

    const TABLE = process.env.DB_TABLE;
    const DB_KEY = process.env.DB_KEY;
    const refund = new DBSave(req, DATA, SID, TABLE, DB_KEY);

    const result = await refund.save();
    console.log('입력 데이터 저장 결과: ');
    console.log(result);

    if (!result.ok) {
      if (result.message?.includes('Duplicate')) {
        return res.send({
          validity: false,
          data: {
            DATA: null,
            FNM: '',
            message: '중복 신청입니다. 현황 조회를 이용해주세요',
          },
        });
      }
      return res.send({
        validity: false,
        data: {
          DATA: null,
          FNM: '',
          message:
            '데이터 저장 실패: ' + result.message,
        },
      });
    }

    /** 진행 상황 로그 업데이트 */
    const TABLE_STATUS = process.env.STATUS_TABLE;
    const REFUND_STATUS_DB_KEY = process.env.STATUS_DB_KEY;
    const PAYLOAD = {
      TUID: DATA.TUID,
      STATUS: '접수',
      COMMENT: '',
    };
    const statusLog = new DBSave(
      req,
      PAYLOAD,
      SID,
      TABLE_STATUS,
      REFUND_STATUS_DB_KEY
    );
    const logResult = await statusLog.save();

    console.log('진행 상황 로그 저장 결과: ');
    console.log(logResult);

    if (!logResult.ok) {
      return res.send({
        validity: false,
        data: {
          DATA: null,
          FNM: '',
          message: '환불 진행 상태 업데이트 실패: ' + logResult.message,
        },
      });
    }

    res.status(200).send({
      validity: true,
      data: { DATA: null, FNM: '', message: '환불 신청 완료' },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      validity: false,
      data: { DATA: null, FNM: '', message: error },
    });
  }
});

export default router;
