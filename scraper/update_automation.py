import os
import subprocess
import sys

def main():
    target_dir = r"D:\YT-Scraper"
    bat_path = os.path.join(target_dir, "run_midnight_sweep.bat")
    task_name = "YouTube_Scraper_Daily_Run"

    print("[+] Step 1: Upgrading the batch execution script (Max Rounds: 100)...")
    bat_content = (
        "@echo off\n"
        f"cd /d {target_dir}\n"
        "set PYTHONIOENCODING=utf-8\n"
        "python orchestrator.py --niche \"Fitness\" --target 300 --max-rounds 100\n"
        "pause\n"
    )

    try:
        with open(bat_path, "w", encoding="utf-8") as f:
            f.write(bat_content)
        print(f"    -> Successfully upgraded: {bat_path}")
    except Exception as e:
        print(f"[-] Failed to write batch file: {e}")
        sys.exit(1)

    print("\n[+] Step 2: Shifting Task Scheduler to the 10:15 AM Quota Reset Window...")
    
    # Wipe the old task
    subprocess.run(f'schtasks /delete /tn "{task_name}" /f', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Create the new task at 10:15 AM
    create_cmd = (
        f'schtasks /create /tn "{task_name}" '
        f'/tr "{bat_path}" '
        f'/sc DAILY /st 10:15 /f'
    )
    
    result = subprocess.run(create_cmd, shell=True, capture_output=True, text=True)
    
    if result.returncode == 0:
        print("    -> Windows Task Scheduler successfully shifted to 10:15 AM!")
        print("\n[!] CRITICAL: Because the task was rebuilt via the command line, Windows locked the hardware wake flag again.")
        print("    You MUST open Task Scheduler, double-click the task, go to 'Conditions', and check 'Wake the computer' one last time.")
    else:
        print(f"[-] Failed to update Windows task. Error:\n{result.stderr}")

if __name__ == "__main__":
    main()