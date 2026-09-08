import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TrendQueueEventsListener } from './trends-queue.events';
import { TechTrendRepository } from '../repositories/tech-trend.repository';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TrendQueueEventsListener', () => {
  let listener: TrendQueueEventsListener;
  let repository: jest.Mocked<TechTrendRepository>;

  const mockAdminWebhook = 'https://discord.com/api/webhooks/admin';
  const mockUserWebhook = 'https://discord.com/api/webhooks/user';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendQueueEventsListener,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'CLIENT_URL') return 'http://localhost:3000';
              if (key === 'DISCORD_ADMIN_WEBHOOK_URL') return mockAdminWebhook;
              if (key === 'DISCORD_USER_WEBHOOK_URL') return mockUserWebhook;
              return defaultValue;
            }),
          },
        },
        {
          provide: TechTrendRepository,
          useValue: {
            findSavedSince: jest.fn(),
          },
        },
      ],
    }).compile();

    listener = module.get<TrendQueueEventsListener>(TrendQueueEventsListener);
    repository = module.get(TechTrendRepository);

    jest.clearAllMocks();
  });

  describe('onCompleted 기본 테스트', () => {
    it('스크래핑 성공 시 관리자와 유저 채널 양쪽에 알림 메시지를 발송해야 한다', async () => {
      const mockReturnValue = {
        sourceName: 'GEEKS',
        savedCount: 1,
        savedArticles: [],
      };

      repository.findSavedSince.mockResolvedValue([
        {
          id: 99,
          title: '단일 테스트 아티클',
          sourceId: 'geeks-99',
          url: 'https://geeks.com/99',
        },
      ]);

      mockedAxios.post.mockResolvedValue({ status: 200 });

      await listener.onCompleted({
        jobId: 'job-456',
        returnvalue: mockReturnValue,
      });

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        mockUserWebhook,
        expect.objectContaining({
          content: expect.stringContaining('📢 **[GEEKS] 새로운 트렌드 아티클이 도착했습니다!**'),
        }),
      );
    });

    it('재시도로 저장이 나뉘더라도 오늘 누적 전체를 조회해 알림에 반영해야 한다', async () => {
      // 이번 실행에서는 2개만 새로 저장됐다고 returnvalue에 담겼지만,
      // 오늘 DB에는 총 5개가 저장돼 있음을 시뮬레이션
      const mockReturnValue = {
        sourceName: 'dev.to',
        savedCount: 2,
        savedArticles: [
          { id: 4, title: '이번 실행 저장 A', sourceId: 'a-4', url: 'https://dev.to/4' },
          { id: 5, title: '이번 실행 저장 B', sourceId: 'a-5', url: 'https://dev.to/5' },
        ],
      };

      repository.findSavedSince.mockResolvedValue([
        { id: 1, title: '오늘 아티클 1', sourceId: 'a-1', url: 'https://dev.to/1' },
        { id: 2, title: '오늘 아티클 2', sourceId: 'a-2', url: 'https://dev.to/2' },
        { id: 3, title: '오늘 아티클 3', sourceId: 'a-3', url: 'https://dev.to/3' },
        { id: 4, title: '이번 실행 저장 A', sourceId: 'a-4', url: 'https://dev.to/4' },
        { id: 5, title: '이번 실행 저장 B', sourceId: 'a-5', url: 'https://dev.to/5' },
      ]);

      mockedAxios.post.mockResolvedValue({ status: 200 });

      await listener.onCompleted({
        jobId: 'job-999',
        returnvalue: mockReturnValue,
      });

      // 관리자 알림에 "오늘 누계 5개"가 반영되어야 한다
      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        1,
        mockAdminWebhook,
        expect.objectContaining({
          content: expect.stringContaining('저장 건수(오늘 누계): **5개**'),
        }),
      );

      // 유저 알림에 오늘 누적 5개가 모두 나열되어야 한다
      const userCallPayload = mockedAxios.post.mock.calls[1][1] as { content: string };
      expect(userCallPayload.content).toContain('오늘 아티클 1');
      expect(userCallPayload.content).toContain('이번 실행 저장 B');
    });

    it('아티클 제목에 디스코드 마크다운 파괴 특수문자(괄호, 백틱, 대괄호)가 포함되면 이스케이프 처리해야 한다', async () => {
      const mockReturnValue = {
        sourceName: 'GEEKS',
        savedCount: 1,
        savedArticles: [],
      };

      repository.findSavedSince.mockResolvedValue([
        {
          id: 1,
          title: 'Bash 명령어 실행 결과의 후행 개행 문자( ) 유지하는 방법 [테스트] `code`',
          sourceId: 'geeks-1',
          url: 'https://geeks.com/1',
        },
      ]);

      mockedAxios.post.mockResolvedValue({ status: 200 });

      await listener.onCompleted({
        jobId: 'job-789',
        returnvalue: mockReturnValue,
      });

      const userCallPayload = mockedAxios.post.mock.calls[1][1] as { content: string };

      expect(userCallPayload.content).toContain('문자\\( \\)');
      expect(userCallPayload.content).toContain('\\[테스트\\]');
      expect(userCallPayload.content).toContain('\\`code\\`');
    });

    it('아티클 목록이 1900자를 초과하면 메시지를 자르고 남은 개수를 표시해야 한다', async () => {
      const mockArticles = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        title: `엄청나게 긴 아티클 제목입니다. 테스트 용도입니다. ${i + 1}`.repeat(3),
        sourceId: `source-${i + 1}`,
        url: `https://example.com/${i + 1}`,
      }));

      const mockReturnValue = {
        sourceName: 'VELOG',
        savedCount: 50,
        savedArticles: [],
      };

      repository.findSavedSince.mockResolvedValue(mockArticles);

      mockedAxios.post.mockResolvedValue({ status: 200 });

      await listener.onCompleted({
        jobId: 'job-123',
        returnvalue: JSON.stringify(mockReturnValue),
      });

      const userCallPayload = mockedAxios.post.mock.calls[1][1] as { content: string };
      
      expect(userCallPayload.content).toContain('...외');
      expect(userCallPayload.content).toMatch(/\*\*\d+개\*\*의 아티클이 더 있습니다\./);
    });
  });

  describe('onFailed 테스트', () => {
    it('작업 실패 시 관리자 채널로 실패 사유 메시지를 발송해야 한다', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await listener.onFailed({
        jobId: 'job-999',
        failedReason: 'AI API Timeout',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockAdminWebhook,
        expect.objectContaining({
          content: expect.stringContaining('🚨 **[BullMQ 스크래퍼 실패]**'),
        }),
      );
    });
  });
});