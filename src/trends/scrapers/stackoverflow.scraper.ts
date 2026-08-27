import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Article, ArticleDetails, IArticleScraper } from '../interfaces/scraper.interface';

@Injectable()
export class StackOverflowScraper implements IArticleScraper {
  private readonly logger = new Logger(StackOverflowScraper.name);

  private readonly STACKOVERFLOW_API_URL = 'https://api.stackexchange.com/2.3';
  private readonly HEADERS = { 'User-Agent': 'TechTrendCollector/1.0' };
  public readonly sourceName = 'stackoverflow';

  private readonly PAGE_SIZE = 100;
  private readonly MIN_SCORE = 3;

  // 최근 일주일간 인기 질문 수집
  async getArticles(): Promise<Article[]> {
    try {
      this.logger.debug(`[Scraper:StackOverflow] 인기 질문 수집 시작 | minScore=${this.MIN_SCORE}`);

      const startTime = Date.now();
      const response = await axios.get(
        `${this.STACKOVERFLOW_API_URL}/questions`,
        {
          params: {
            order: 'desc',
            sort: 'week',
            site: 'stackoverflow',
            pagesize: this.PAGE_SIZE,
            filter: 'withbody',
          },
          headers: this.HEADERS,
          timeout: 5000,
        },
      );

      this.logger.debug(`[Scraper:StackOverflow] 질문 목록 네트워크 요청 완료 | 소요시간=${Date.now() - startTime}ms`);

      const questions = response.data?.items;

      if (!Array.isArray(questions)) {
        this.logger.warn('[Scraper:StackOverflow] 질문 목록이 올바른 배열 형태가 아닙니다.');
        return [];
      }

      // 점수가 너무 낮은 질문은 제외
      const filteredQuestions = questions
        .filter((question: any) => (question.score ?? 0) >= this.MIN_SCORE)
        .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));

      this.logger.debug(
        `[Scraper:StackOverflow] 인기 질문 필터링 완료 | total=${questions.length}, filtered=${filteredQuestions.length}`,
      );

      return filteredQuestions.map((question: any) => ({
        id: String(question.question_id),
        title: question.title?.trim() || '제목 없음',
        url: question.link || '',
        created_at: question.creation_date
          ? new Date(question.creation_date * 1000).toISOString().split('T')[0]
          : '',
        source: this.sourceName,
      }));
    } catch (error: any) {
      this.logger.error(`[Scraper:StackOverflow] 질문 목록 수집 실패 | error=${error.message}`);
      throw error;
    }
  }

  // 본문 상세 정보 수집
  async getArticleDetails(
    articleId: string,
  ): Promise<ArticleDetails | null> {
    try {
      const startTime = Date.now();

      // 본문 요청
      const response = await axios.get(
        `${this.STACKOVERFLOW_API_URL}/questions/${articleId}`,
        {
          params: {
            site: 'stackoverflow',
            filter: 'withbody',
          },
          headers: this.HEADERS,
          timeout: 5000,
        },
      );

      this.logger.debug(`[Scraper:StackOverflow] 질문 상세 네트워크 요청 완료 | articleId=${articleId}, 소요시간=${Date.now() - startTime}ms`);

      const question = response.data?.items?.[0];
      if (!question) return null;

      const rawQuestionBody = question.body?.trim();
      if (!rawQuestionBody) return null;

      // 2. 해당 질문의 답변 목록 수집
      let bestAnswerText = '등록된 답변이 없거나 유효한 답변이 없습니다.';
      try {
        const answersResponse = await axios.get(
          `${this.STACKOVERFLOW_API_URL}/questions/${articleId}/answers`,
          {
            params: {
              site: 'stackoverflow',
              filter: 'withbody',
              sort: 'votes',
              order: 'desc',
              pagesize: 5,
            },
            headers: this.HEADERS,
            timeout: 5000,
          },
        );

        const answers = answersResponse.data?.items;
        if (Array.isArray(answers) && answers.length > 0) {
          const acceptedAnswer = answers.find((a: any) => a.is_accepted);
          const targetAnswer = acceptedAnswer || answers[0];

          if (targetAnswer?.body) {
            bestAnswerText = this.stripHtml(targetAnswer.body);
          }
        }
      } catch (answerError: any) {
        this.logger.warn(
          `[Scraper:StackOverflow] 답변 수집 실패 (질문 본문만 활용) | articleId=${articleId}`,
        );
      }

      // 질문 + 답변 병합 및 HTML 정제
      const cleanQuestionBody = this.stripHtml(rawQuestionBody);
      const combinedContent = this.formatContent(cleanQuestionBody, bestAnswerText);

      return {
        content: combinedContent,
        view_count: question.view_count ?? null,
        like_count: question.score ?? null, // Upvote 점수
        comment_count: question.answer_count ?? null, // 답변 수
      };
    } catch (error: any) {
      this.logger.warn(`[Scraper:StackOverflow] 질문 상세 수집 실패 | articleId=${articleId}, error=${error.message}`);

      return null;
    }
  }

  // 본문 및 답변 포맷팅
  private formatContent(questionBody: string, answerText: string): string {
    return [
      `[질문 또는 본문(Problem)]\n${questionBody}`,
      `[해결 답변 (Solution)]\n${answerText}`,
    ].join('\n\n');
  }

  // HTML 태그 제거 및 코드 블록 보존
  private stripHtml(html: string): string {
    return html
      .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}