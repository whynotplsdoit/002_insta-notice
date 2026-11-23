' 작업 스케줄러가 실행하는 파일: 검은 명령 창 없이 새 글 감시(npm run watch)를 실행합니다.
' 실행 결과는 data\watch-out.txt, 수집 기록은 data\crawl-log.txt 에 남습니다.
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(projectDir & "\data") Then fso.CreateFolder(projectDir & "\data")

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = projectDir
' 0 = 창 숨김, True = 끝날 때까지 기다림 (작업 스케줄러가 겹쳐 실행하지 않도록)
shell.Run "cmd /c npm.cmd run watch -- --hidden >> data\watch-out.txt 2>&1", 0, True
