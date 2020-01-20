import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Transactional } from 'typeorm-transactional-cls-hooked';
import { CourseTakenRepository } from '../repository';
import { CourseTaken } from '../entity';
import { CourseTakenUpdateDTO, CourseTakenDTO, NewCourseTakenDTO, AttendAClassDTO } from '../dto';
import { CourseTakenMapper } from '../mapper';
import { Course, Lesson, Part, Test, LessonService, PartService, TestService, CourseService } from '../../CourseModule';
import { CourseTakenStatusEnum } from '../enum';
import { CourseDTO, LessonDTO, PartDTO, TestWithoutCorrectAlternativeDTO } from '../../CourseModule/dto';

@Injectable()
export class CourseTakenService {

  constructor(
    private readonly repository: CourseTakenRepository,
    private readonly mapper: CourseTakenMapper,
    private readonly courseService: CourseService,
    private readonly lessonService: LessonService,
    private readonly partService: PartService,
    private readonly testService: TestService,
  ){
  }

  //funcionando
  @Transactional()
  public async add(newCourseTaken: NewCourseTakenDTO): Promise<AttendAClassDTO> {
    const courseAlreadyTaken: CourseTaken = await this.repository.findByUserIdAndCourseId(newCourseTaken.user, newCourseTaken.course);
    if (courseAlreadyTaken){
        throw new ConflictException('Course already taken by user');
    }

    const newCourseTakenEntity = this.mapper.toEntity(newCourseTaken);

    newCourseTakenEntity.currentLesson = 1;
    newCourseTakenEntity.currentPart = 1;
    newCourseTakenEntity.currentTest = 1;
    newCourseTakenEntity.status = CourseTakenStatusEnum.TAKEN;
    newCourseTakenEntity.courseStartDate = new Date(Date.now());

    await this.repository.save(newCourseTakenEntity);

    return await this.attendAClass(newCourseTaken.user, newCourseTaken.course);
  }

  //funcionando
  @Transactional()
  public async update(user: CourseTaken['user'], course: CourseTaken['course'], courseTakenUpdatedInfo: CourseTakenUpdateDTO): Promise<CourseTaken> {
    const courseTaken: CourseTaken = await this.findByUserIdAndCourseId(user, course);
    return this.repository.save(this.mapper.toEntity({ ...courseTaken, ...courseTakenUpdatedInfo}))
  }

  //funcionando
  @Transactional()
  public async getAllByUserId(user: CourseTaken['user']): Promise<CourseTaken[]> {
    const courseTaken: CourseTaken[] = await this.repository.findByUserId(user);
    if (!courseTaken){
      throw new NotFoundException('This user did not started any course');
    }
    return courseTaken;
  }

  //funcionando
  @Transactional()
  public async getAllByCourseId(course: CourseTaken['course']): Promise<CourseTaken[]> {
    const courseTaken: CourseTaken[] = await this.repository.findByCourseId(course);
    if (!courseTaken){
        throw new NotFoundException('No users have started this course');
    }
    return courseTaken;
  }

  //Testar
  @Transactional()
  public async attendAClass(user: CourseTaken['user'], course: CourseTaken['course']): Promise<AttendAClassDTO>{
    let courseTaken: CourseTaken = await this.findByUserIdAndCourseId(user, course);
    const attendAClass = new AttendAClassDTO;

    const currentLesson: LessonDTO = await this.lessonService.findLessonByCourseIdAndSeqNum(course, courseTaken.currentLesson);
    let currentPart: PartDTO;
    let currentTest: TestWithoutCorrectAlternativeDTO;

    let invalidOptionFlag = true;
    if (currentLesson){
      currentPart = await this.partService.findPartByLessonIdAndSeqNum(currentLesson.id, courseTaken.currentPart);

      if (currentPart){
        currentTest = await this.testService.findTestByPartIdAndSeqNum(currentPart.id, courseTaken.currentTest);

        if(currentTest){
          invalidOptionFlag = false;
          return await this.prepareAttendAClassDTO(attendAClass, courseTaken, course, currentLesson, currentPart, currentTest);
        }
      }
    }

    if (invalidOptionFlag){
      courseTaken = await this.updateCourseStatus(user, course);
    }

    if (courseTaken.status === CourseTakenStatusEnum.COMPLETED) {
      return await this.prepareAttendAClassDTO(attendAClass, courseTaken, course);
    }
    else {
      return await this.attendAClass(user, course);
    }
  }

  private async prepareAttendAClassDTO(attendAClass: AttendAClassDTO, courseTaken: CourseTaken, course: CourseDTO, currentLesson?: LessonDTO, currentPart?: PartDTO, currentTest?: TestWithoutCorrectAlternativeDTO) {

    attendAClass.user = courseTaken.user;
    attendAClass.course = course;
    attendAClass.currentLesson = currentLesson;
    attendAClass.currentPart = currentPart;
    attendAClass.currentTest = currentTest;
    attendAClass.completition = courseTaken.completition;
    attendAClass.status = courseTaken.status;

    return attendAClass;
  }

  @Transactional()
  public async findByUserIdAndCourseId(user: CourseTaken['user'], course: CourseTaken['course']): Promise<CourseTaken> {
    const courseTaken: CourseTaken = await this.repository.findOne({ user, course}, { relations: ['user', 'course'] });
    if (!courseTaken){
        throw new NotFoundException('Course not taken by user');
    }
    return courseTaken;
  }

@Transactional()
public async updateCourseStatus(user: CourseTaken['user'], course: CourseTaken['course']): Promise<CourseTaken> {
  let courseTaken = await this.repository.findByUserIdAndCourseId(user, course);
  const currentLessonId: Lesson['id'] = await this.lessonService.getLessonIdByCourseIdAndSeqNum(course, courseTaken.currentLesson);
  const currentPartId = await this.partService.getPartIdByLessonIdAndSeqNum(currentLessonId, courseTaken.currentPart);

  const nextTest = await this.testService.findTestByPartIdAndSeqNum(currentPartId, courseTaken.currentTest+1);
  const nextPart = await this.partService.findPartByLessonIdAndSeqNum(currentLessonId, courseTaken.currentPart+1);
  const nextLesson = await this.lessonService.findLessonByCourseIdAndSeqNum(course, courseTaken.currentLesson+1);
  courseTaken = await this.prepareCourseTakenUpdatedInfo(courseTaken, nextTest, nextPart, nextLesson);
  courseTaken.completition = await this.calculateCompletition(courseTaken, currentLessonId, currentPartId);
  const courseTakenUpdatedInfo = this.mapper.toUpdateDto(courseTaken)

  return this.update(courseTaken.user, courseTaken.course, courseTakenUpdatedInfo);
}

  @Transactional()
  private async prepareCourseTakenUpdatedInfo(courseTaken: CourseTaken, nextTest: Test, nextPart: Part, nextLesson: Lesson): Promise<CourseTaken>{

    if (nextTest){
      courseTaken.currentTest++;
    } else if (nextPart){
        courseTaken.currentTest = 1;
        courseTaken.currentPart++;
    } else if (nextLesson) {
            courseTaken.currentTest = 1;
            courseTaken.currentPart = 1;
            courseTaken.currentLesson++;
    } else {
          courseTaken.status = CourseTakenStatusEnum.COMPLETED;
          courseTaken.courseCompleteDate = new Date(Date.now());
    }
    return courseTaken;
  }

  //conferir
  private async calculateCompletition(courseTaken: CourseTaken, currentLesson: string, currentPart: string): Promise<number> {

    const lessonsAmount: number = await this.lessonService.getMaxValueForLesson(courseTaken.course);
    const partsAmount = await this.partService.getMaxValueForPart(currentLesson);
    const testsAmount = await this.testService.getMaxValueForTest(currentPart);
    let completition: number;

    if (courseTaken.status === CourseTakenStatusEnum.TAKEN) {
      const percentualPerLesson = 100/lessonsAmount;
      const percentualPerPart = percentualPerLesson/partsAmount;
      const percentualPerTest = percentualPerPart/testsAmount;

      completition = percentualPerLesson*(courseTaken.currentLesson-1);
      completition += percentualPerPart*(courseTaken.currentPart-1);
      completition += percentualPerTest*(courseTaken.currentTest-1);
    }
    else{
      completition = 100;
    }

    return completition>100 ?  100 : completition;
  }

  //conferir
  @Transactional()
  public async delete(user: CourseTaken['user'], course: CourseTaken['course']): Promise<void> {
    await this.repository.delete({ user, course });
  }
}
