#define ProductName "PulseDeck"
#define ProductVersion GetEnv("PULSEDECK_VERSION")
#if ProductVersion == ""
  #define ProductVersion "0.1.0"
#endif
#define RepoRoot AddBackslash(SourcePath) + "..\.."

[Setup]
AppId={{A4C6DDF0-CE13-4B97-A8F0-0E6DF2BA6B8A}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppPublisher=PulseDeck
DefaultDirName={localappdata}\Programs\PulseDeck
DefaultGroupName=PulseDeck
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir={#RepoRoot}\release
OutputBaseFilename=PulseDeck-Setup-{#ProductVersion}
UninstallDisplayIcon={app}\backend\PulseDeck.exe
CloseApplications=yes
RestartApplications=no
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "autostart"; Description: "Start PulseDeck when I sign in to Windows"; GroupDescription: "Startup:"; Flags: unchecked

[Files]
Source: "{#RepoRoot}\backend\dist\PulseDeck\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoRoot}\backend\Start-PulseDeck.ps1"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#RepoRoot}\backend\Open-PulseDeck.ps1"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#RepoRoot}\backend\Install-PulseDeck-AutoStart.ps1"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#RepoRoot}\backend\Uninstall-PulseDeck-AutoStart.ps1"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#RepoRoot}\backend\.env.example"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#RepoRoot}\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\PulseDeck"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\backend\Open-PulseDeck.ps1"""; WorkingDir: "{app}\backend"
Name: "{autoprograms}\Uninstall PulseDeck"; Filename: "{uninstallexe}"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\backend\Open-PulseDeck.ps1"""; WorkingDir: "{app}\backend"; Description: "Open PulseDeck now"; Flags: postinstall nowait skipifsilent
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\backend\Install-PulseDeck-AutoStart.ps1"""; WorkingDir: "{app}\backend"; Flags: postinstall nowait skipifsilent; Tasks: autostart

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\backend\Uninstall-PulseDeck-AutoStart.ps1"""; Flags: runhidden
